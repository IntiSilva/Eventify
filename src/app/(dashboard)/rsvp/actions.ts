'use server'

import type Stripe from 'stripe'
import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import type { Prisma, ReminderType } from "@/generated/prisma"
import {
  PaymentPayoutTarget,
  RSVPStatus,
  PaymentStatus,
  RefundRequestStatus,
  RefundRequestSource,
  UserRole,
  RSVPAttendanceEntitlementStatus,
} from "@/generated/prisma"
import type { ToggleRsvpResult, UpdatedEventMinimal, ReminderPatch } from "@/types/rsvp";
import { calcReminderUTC } from "@/lib/reminders"
import { computeAutoFeatured } from "@/lib/constants"
import { linkRsvpToSucceededPayment } from "@/lib/payments/confirmPaidRsvp"
import { getRefundRequestCutoffHours } from "@/lib/payments/refundConfig"
import { computeRefundEligibility, type RefundBlockedReason } from "@/lib/payments/refundEligibility.server"
import { resolveTicketStateForSucceededPayment } from "@/lib/payments/ticketState"
import { stripe } from "@/lib/stripe"
import {
  mapStripeRefundStatusToRefundRequestStatus,
  syncRefundRequestFromStripeRefund,
} from "@/lib/payments/refunds"
import {
  evaluateIsFullRefund,
  syncRsvpAttendanceEntitlementFromRefundStatus,
} from "@/lib/payments/rsvpEntitlement"
import {
  getEventJoinability,
  getEventJoinabilityBlockedMessage,
} from "@/lib/events/joinability"
import {
  CURRENTLY_ATTENDING_RSVP_WHERE,
  hasActiveAttendanceEntitlement,
} from "@/lib/rsvpAttendance"



// =================================================================
// ** HELPERS **
// =================================================================

type RefundActionData = {
  id: string
  paymentId: string
  status: RefundRequestStatus
  stripeRefundId: string | null
}

type RefundContextData = {
  paymentId: string | null
  paymentStatus: PaymentStatus | null
  refundRequest: {
    id: string
    status: RefundRequestStatus
    reason: string | null
    createdAt: string
  } | null
  canRequest: boolean
  blockedReason: RefundBlockedReason | null
  blockedMessage: string | null
}

type RefundContextErrorCode = 'UNAUTHORIZED' | 'INVALID_INPUT' | 'ERROR'

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

export type RefundActionResult =
  | { success: true; message: string; data: RefundActionData }
  | { success: false; message: string; data: null }

export type RefundContextResult =
  | { success: true; data: RefundContextData }
  | {
      success: false
      code: RefundContextErrorCode
      message: string
      data: null
    }

export type RefundRequestListResult =
  | {
      success: true
      data: RefundRequestListItem[]
      filter: {
        status: RefundRequestListFilterStatus
        limit: number
        source: RefundRequestListFilterSource
        payoutTarget: RefundRequestListFilterPayoutTarget
        search: string | null
      }
      hasMore: boolean
    }
  | { success: false; message: string; data: null }

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

export type RefundViewerCountsResult =
  | { success: true; data: RefundViewerCounts }
  | { success: false; message: string; data: null }

function normalizeOptionalShortText(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  if (typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

function toRefundActionData(input: {
  id: string
  paymentId: string
  status: RefundRequestStatus
  stripeRefundId: string | null
}): RefundActionData {
  return {
    id: input.id,
    paymentId: input.paymentId,
    status: input.status,
    stripeRefundId: input.stripeRefundId,
  }
}

function toRefundContextData(input: {
  paymentId: string | null
  paymentStatus: PaymentStatus | null
  refundRequest:
    | {
        id: string
        status: RefundRequestStatus
        reason: string | null
        createdAt: Date
      }
    | null
  canRequest: boolean
  blockedReason: RefundBlockedReason | null
  blockedMessage: string | null
}): RefundContextData {
  return {
    paymentId: input.paymentId,
    paymentStatus: input.paymentStatus,
    refundRequest: input.refundRequest
      ? {
          id: input.refundRequest.id,
          status: input.refundRequest.status,
          reason: input.refundRequest.reason,
          createdAt: input.refundRequest.createdAt.toISOString(),
        }
      : null,
    canRequest: input.canRequest,
    blockedReason: input.blockedReason,
    blockedMessage: input.blockedMessage,
  }
}

function normalizeRefundRequestListFilterStatus(
  value?: RefundRequestListFilterStatus | null
): RefundRequestListFilterStatus {
  if (
    value === 'processing' ||
    value === 'failed' ||
    value === 'rejected' ||
    value === 'succeeded'
  ) {
    return value
  }

  return 'requested'
}

function toRefundRequestStatusFilter(
  status: RefundRequestListFilterStatus
): RefundRequestStatus {
  switch (status) {
    case 'processing':
      return RefundRequestStatus.processing
    case 'failed':
      return RefundRequestStatus.failed
    case 'rejected':
      return RefundRequestStatus.rejected
    case 'succeeded':
      return RefundRequestStatus.succeeded
    case 'requested':
    default:
      return RefundRequestStatus.requested
  }
}

function clampRefundRequestListLimit(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 30
  }

  return Math.min(100, Math.max(1, Math.trunc(value)))
}

function normalizeRefundRequestListFilterSource(
  value?: RefundRequestListFilterSource | null
): RefundRequestListFilterSource {
  if (
    value === 'user_request' ||
    value === 'manual_override' ||
    value === 'system_compensation'
  ) {
    return value
  }

  return 'all'
}

function toRefundRequestSourceFilter(
  source: RefundRequestListFilterSource
): RefundRequestSource | null {
  switch (source) {
    case 'user_request':
      return RefundRequestSource.USER_REQUEST
    case 'manual_override':
      return RefundRequestSource.MANUAL_OVERRIDE
    case 'system_compensation':
      return RefundRequestSource.SYSTEM_COMPENSATION
    case 'all':
    default:
      return null
  }
}

function normalizeRefundRequestListFilterPayoutTarget(
  value?: RefundRequestListFilterPayoutTarget | null
): RefundRequestListFilterPayoutTarget {
  if (value === 'organizer' || value === 'platform') {
    return value
  }

  return 'all'
}

function normalizeRefundRequestListSearch(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().slice(0, 80)
  return normalized.length > 0 ? normalized : null
}

function getRefundRequestActionMessage(
  status: RefundRequestStatus,
  options?: {
    pendingMessage?: string
    succeededMessage?: string
  }
): string {
  if (status === RefundRequestStatus.succeeded) {
    return options?.succeededMessage ?? 'This refund has already been completed.'
  }

  if (status === RefundRequestStatus.processing) {
    return options?.pendingMessage ?? 'This refund is already being processed.'
  }

  return 'A Stripe refund has already been created for this payment.'
}

function getRefundRequestCutoffMessage(cutoffHours: number): string {
  return `Refund requests must be submitted at least ${cutoffHours} hour${cutoffHours === 1 ? '' : 's'} before the event.`
}

function getRefundContextBlockedMessage(input: {
  blockedReason: RefundBlockedReason | null
  cutoffHours: number
  hasExistingRefundRequest: boolean
}): string | null {
  if (input.hasExistingRefundRequest) {
    return 'A refund request already exists for this payment.'
  }

  switch (input.blockedReason) {
    case 'CUTOFF':
      return getRefundRequestCutoffMessage(input.cutoffHours)
    case 'EVENT_STARTED':
      return 'Refunds are unavailable because the event already started.'
    case 'NO_PAYMENT':
      return 'No payment found for this event.'
    case 'UNKNOWN':
      return 'Refund eligibility could not be determined right now.'
    default:
      return null
  }
}

async function syncAttendanceEntitlementForRefundStatus(input: {
  paymentId: string
  refundStatus: RefundRequestStatus
  isFullRefund?: boolean | null
  context: string
}): Promise<void> {
  try {
    await syncRsvpAttendanceEntitlementFromRefundStatus({
      paymentId: input.paymentId,
      refundStatus: input.refundStatus,
      isFullRefund: input.isFullRefund,
    })
  } catch (error) {
    console.error(
      `[refund-entitlement] failed during ${input.context} for payment ${input.paymentId}`,
      error
    )
  }
}

function sanitizeRefundErrorMessage(error: unknown, fallback: string): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : fallback
  const normalized = raw.trim()
  const finalMessage = normalized.length > 0 ? normalized : fallback
  return finalMessage.slice(0, 1000)
}

async function getRefundActionSnapshot(refundRequestId: string) {
  return prisma.refundRequest.findUnique({
    where: { id: refundRequestId },
    select: {
      id: true,
      paymentId: true,
      status: true,
      stripeRefundId: true,
    },
  })
}

function toRefundRequestListItem(input: {
  id: string
  status: RefundRequestStatus
  source: RefundRequestSource
  reason: string | null
  decisionNote: string | null
  createdAt: Date
  stripeRefundId: string | null
  attemptCount: number
  lastError: string | null
  lastAttemptAt: Date | null
  payment: {
    id: string
    amountCents: number
    currency: string
    payoutTarget: PaymentPayoutTarget
    destinationAccountId: string | null
    transferGroup: string | null
    applicationFeeAmount: number | null
    userId: string
    eventId: string
    user: {
      username: string | null
      firstName: string | null
      lastName: string | null
      email: string | null
    }
    event: {
      title: string
      createdBy: string
      creator: {
        username: string | null
        firstName: string | null
        lastName: string | null
        role: UserRole | null
      }
    }
  }
}): RefundRequestListItem {
  return {
    refundRequestId: input.id,
    status: input.status,
    source: input.source,
    reason: input.reason,
    decisionNote: input.decisionNote,
    createdAt: input.createdAt.toISOString(),
    paymentId: input.payment.id,
    eventId: input.payment.eventId,
    eventTitle: input.payment.event.title,
    organizerClerkId: input.payment.event.createdBy,
    organizerUsername: input.payment.event.creator.username,
    organizerFirstName: input.payment.event.creator.firstName,
    organizerLastName: input.payment.event.creator.lastName,
    counterpartyRole: input.payment.event.creator.role,
    buyerUserId: input.payment.userId,
    buyerUsername: input.payment.user.username,
    buyerFirstName: input.payment.user.firstName,
    buyerLastName: input.payment.user.lastName,
    buyerEmail: input.payment.user.email,
    amountCents: input.payment.amountCents,
    currency: input.payment.currency,
    payoutTarget: input.payment.payoutTarget,
    destinationAccountId: input.payment.destinationAccountId,
    transferGroup: input.payment.transferGroup,
    applicationFeeAmount: input.payment.applicationFeeAmount,
    stripeRefundId: input.stripeRefundId,
    attemptCount: input.attemptCount,
    lastError: input.lastError,
    lastAttemptAt: input.lastAttemptAt ? input.lastAttemptAt.toISOString() : null,
  }
}

async function getAuthenticatedRefundActor() {
  const { userId } = await auth()
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { clerkId: true, role: true },
  })

  return user
}

function buildRefundViewerWhere(
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedRefundActor>>>
) {
  return {
    ...(actor.role === UserRole.organizer
      ? {
          payment: {
            event: {
              createdBy: actor.clerkId,
            },
          },
        }
      : {}),
  }
}

function buildRefundRequestListWhere(input: {
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedRefundActor>>>
  statusFilter: RefundRequestStatus
  sourceFilter: RefundRequestSource | null
  payoutTargetFilter: PaymentPayoutTarget | null
  search: string | null
}): Prisma.RefundRequestWhereInput {
  const andClauses: Prisma.RefundRequestWhereInput[] = [
    { status: input.statusFilter },
  ]

  if (input.actor.role === UserRole.organizer) {
    andClauses.push({
      payment: {
        event: {
          createdBy: input.actor.clerkId,
        },
      },
    })
  }

  if (input.sourceFilter) {
    andClauses.push({ source: input.sourceFilter })
  }

  if (input.payoutTargetFilter) {
    andClauses.push({
      payment: {
        payoutTarget: input.payoutTargetFilter,
      },
    })
  }

  if (input.search) {
    andClauses.push({
      OR: [
        { payment: { event: { title: { contains: input.search, mode: 'insensitive' } } } },
        { payment: { event: { creator: { username: { contains: input.search, mode: 'insensitive' } } } } },
        { payment: { event: { creator: { firstName: { contains: input.search, mode: 'insensitive' } } } } },
        { payment: { event: { creator: { lastName: { contains: input.search, mode: 'insensitive' } } } } },
        { payment: { user: { username: { contains: input.search, mode: 'insensitive' } } } },
        { payment: { user: { firstName: { contains: input.search, mode: 'insensitive' } } } },
        { payment: { user: { lastName: { contains: input.search, mode: 'insensitive' } } } },
        { payment: { user: { email: { contains: input.search, mode: 'insensitive' } } } },
      ],
    })
  }

  return { AND: andClauses }
}

export async function getMyRefundContextForEvent(
  eventId: string
): Promise<RefundContextResult> {
  const { userId } = await auth()
  if (!userId) {
    return {
      success: false,
      code: 'UNAUTHORIZED',
      message: 'Unauthorized. Please sign in to view refund status.',
      data: null,
    }
  }

  const normalizedEventId = eventId.trim()
  if (!normalizedEventId) {
    return {
      success: false,
      code: 'INVALID_INPUT',
      message: 'Missing event id.',
      data: null,
    }
  }

  try {
    const cutoffHours = getRefundRequestCutoffHours()
    const payment = await prisma.payment.findFirst({
      where: {
        eventId: normalizedEventId,
        userId,
        status: PaymentStatus.succeeded,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        event: {
          select: {
            date: true,
          },
        },
        refundRequest: {
          select: {
            id: true,
            status: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    })

    const eligibility = payment?.refundRequest
      ? { canRequest: false, blockedReason: null }
      : computeRefundEligibility({
          hasPayment: Boolean(payment),
          eventStartsAt: payment?.event.date,
          cutoffHours,
        })

    const blockedMessage = getRefundContextBlockedMessage({
      blockedReason: eligibility.blockedReason,
      cutoffHours,
      hasExistingRefundRequest: Boolean(payment?.refundRequest),
    })

    return {
      success: true,
      data: toRefundContextData({
        paymentId: payment?.id ?? null,
        paymentStatus: payment?.status ?? null,
        refundRequest: payment?.refundRequest ?? null,
        canRequest: eligibility.canRequest,
        blockedReason: eligibility.blockedReason,
        blockedMessage,
      }),
    }
  } catch (error) {
    console.error(
      `[refund] failed to load refund context for user ${userId} on event ${normalizedEventId}`,
      error
    )
    return {
      success: false,
      code: 'ERROR',
      message: 'Could not load refund status.',
      data: null,
    }
  }
}

export async function listRefundRequestsForViewer(input?: {
  status?: RefundRequestListFilterStatus
  limit?: number
  source?: RefundRequestListFilterSource
  payoutTarget?: RefundRequestListFilterPayoutTarget
  search?: string
}): Promise<RefundRequestListResult> {
  const actor = await getAuthenticatedRefundActor()
  if (!actor) {
    return {
      success: false,
      message: 'Unauthorized. Please sign in to view refund requests.',
      data: null,
    }
  }

  if (actor.role !== UserRole.organizer && actor.role !== UserRole.admin) {
    return {
      success: false,
      message: 'Only organizers and admins can view refund requests.',
      data: null,
    }
  }

  const status = normalizeRefundRequestListFilterStatus(input?.status)
  const limit = clampRefundRequestListLimit(input?.limit)
  const source = normalizeRefundRequestListFilterSource(input?.source)
  const requestedPayoutTarget = normalizeRefundRequestListFilterPayoutTarget(input?.payoutTarget)
  const payoutTarget =
    actor.role === UserRole.organizer ? 'all' : requestedPayoutTarget
  const search = normalizeRefundRequestListSearch(input?.search)
  const statusFilter = toRefundRequestStatusFilter(status)
  const sourceFilter = toRefundRequestSourceFilter(source)
  const payoutTargetFilter =
    payoutTarget === 'all'
      ? null
      : payoutTarget === 'organizer'
      ? PaymentPayoutTarget.organizer
      : PaymentPayoutTarget.platform
  const listWhere = buildRefundRequestListWhere({
    actor,
    statusFilter,
    sourceFilter,
    payoutTargetFilter,
    search,
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log('[refund] listRefundRequestsForViewer:start', {
      role: actor.role,
      clerkId: actor.clerkId,
      status,
      limit,
      source,
      payoutTarget,
      search,
    })
  }

  try {
    const refundRequests = await prisma.refundRequest.findMany({
      where: listWhere,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true,
        status: true,
        source: true,
        reason: true,
        decisionNote: true,
        createdAt: true,
        stripeRefundId: true,
        attemptCount: true,
        lastError: true,
        lastAttemptAt: true,
        payment: {
          select: {
            id: true,
            amountCents: true,
            currency: true,
            payoutTarget: true,
            destinationAccountId: true,
            transferGroup: true,
            applicationFeeAmount: true,
            userId: true,
            eventId: true,
            user: {
              select: {
                username: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            event: {
              select: {
                title: true,
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
          },
        },
      },
    })

    const hasMore = refundRequests.length > limit
    const rows = hasMore ? refundRequests.slice(0, limit) : refundRequests

    if (process.env.NODE_ENV !== 'production') {
      console.log('[refund] listRefundRequestsForViewer:done', {
        role: actor.role,
        clerkId: actor.clerkId,
        status,
        limit,
        source,
        payoutTarget,
        search,
        rows: rows.length,
        hasMore,
      })
    }

    return {
      success: true,
      data: rows.map(toRefundRequestListItem),
      filter: {
        status,
        limit,
        source,
        payoutTarget,
        search,
      },
      hasMore,
    }
  } catch (error) {
    console.error('[refund] listRefundRequestsForViewer:error', {
      role: actor.role,
      clerkId: actor.clerkId,
      status,
      limit,
      source,
      payoutTarget,
      search,
      error,
    })

    return {
      success: false,
      message: 'Could not load refund requests.',
      data: null,
    }
  }
}

export async function getRefundCountsForViewer(): Promise<RefundViewerCountsResult> {
  const actor = await getAuthenticatedRefundActor()
  if (!actor) {
    return {
      success: false,
      message: 'Unauthorized. Please sign in to view refund counts.',
      data: null,
    }
  }

  if (actor.role !== UserRole.organizer && actor.role !== UserRole.admin) {
    return {
      success: false,
      message: 'Only organizers and admins can view refund counts.',
      data: null,
    }
  }

  const where = buildRefundViewerWhere(actor)

  const [total, grouped] = await Promise.all([
    prisma.refundRequest.count({ where }),
    prisma.refundRequest.groupBy({
      by: ['status'],
      where,
      _count: {
        _all: true,
      },
    }),
  ])

  const counts: RefundViewerCounts = {
    all: total,
    requested: 0,
    processing: 0,
    failed: 0,
    rejected: 0,
    succeeded: 0,
    canceled: 0,
    needsAttention: 0,
  }

  for (const row of grouped) {
    switch (row.status) {
      case RefundRequestStatus.requested:
        counts.requested = row._count._all
        break
      case RefundRequestStatus.processing:
      case RefundRequestStatus.approved:
        counts.processing += row._count._all
        break
      case RefundRequestStatus.failed:
        counts.failed = row._count._all
        break
      case RefundRequestStatus.rejected:
        counts.rejected = row._count._all
        break
      case RefundRequestStatus.succeeded:
        counts.succeeded = row._count._all
        break
      case RefundRequestStatus.canceled:
        counts.canceled = row._count._all
        break
      default:
        break
    }
  }

  counts.needsAttention = counts.requested + counts.processing + counts.failed

  return {
    success: true,
    data: counts,
  }
}

async function markRefundRequestFailed(
  refundRequestId: string,
  paymentId: string,
  error: unknown
): Promise<void> {
  try {
    await prisma.refundRequest.updateMany({
      where: { id: refundRequestId },
      data: {
        status: RefundRequestStatus.failed,
        lastError: sanitizeRefundErrorMessage(error, 'Refund processing failed.'),
      },
    })
    await syncAttendanceEntitlementForRefundStatus({
      paymentId,
      refundStatus: RefundRequestStatus.failed,
      context: `markRefundRequestFailed(${refundRequestId})`,
    })
  } catch (error) {
    console.error(`[refund] failed to mark refund request ${refundRequestId} as failed`, error)
  }
}

function getManualRefundClaimableStatuses(isAdmin: boolean): RefundRequestStatus[] {
  return isAdmin
    ? [
        RefundRequestStatus.requested,
        RefundRequestStatus.failed,
        RefundRequestStatus.rejected,
        RefundRequestStatus.canceled,
      ]
    : [RefundRequestStatus.requested, RefundRequestStatus.failed]
}

async function claimRefundRequestForProcessing(input: {
  refundRequestId: string
  paymentId: string
  actorClerkId: string
  note?: string | null
  allowedStatuses: RefundRequestStatus[]
}): Promise<boolean> {
  const attemptedAt = new Date()
  const result = await prisma.refundRequest.updateMany({
    where: {
      id: input.refundRequestId,
      status: { in: input.allowedStatuses },
    },
    data: {
      status: RefundRequestStatus.processing,
      decidedByUserId: input.actorClerkId,
      decidedAt: attemptedAt,
      decisionNote: normalizeOptionalShortText(input.note),
      attemptCount: { increment: 1 },
      lastAttemptAt: attemptedAt,
      lastError: null,
    },
  })

  if (result.count > 0) {
    await syncAttendanceEntitlementForRefundStatus({
      paymentId: input.paymentId,
      refundStatus: RefundRequestStatus.processing,
      context: `claimRefundRequestForProcessing(${input.refundRequestId})`,
    })
  }

  return result.count > 0
}

async function resolveRefundChargeId(payment: {
  id: string
  stripeChargeId: string | null
  stripePaymentIntentId: string
}): Promise<string | null> {
  if (payment.stripeChargeId) {
    return payment.stripeChargeId
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(payment.stripePaymentIntentId, {
      expand: ['latest_charge'],
    })

    return stripeObjectId(
      intent.latest_charge as string | { id: string } | null | undefined
    )
  } catch (error) {
    console.error(
      `[refund] failed to retrieve payment intent ${payment.stripePaymentIntentId} while resolving charge for payment ${payment.id}`,
      error
    )
    return null
  }
}


// Recalculates confirmed count and updates `featured` in the DB.
//  Returns the minimal info the client needs to reconcile.
async function updateEventFeaturedAndCount(eventId: string): Promise<{ updatedEvent: UpdatedEventMinimal }> {
  const base = await prisma.event.findUnique({
    where: { id: eventId },
    select: { featured: true },
  });

  const confirmedCount = await prisma.rSVP.count({
    where: {
      eventId,
      ...CURRENTLY_ATTENDING_RSVP_WHERE,
    },
  });

  const nextFeatured = computeAutoFeatured(confirmedCount);

  let updated: { id: string; featured: boolean; };
  if (base && base.featured === nextFeatured) {
    // no-op: already correct, skip UPDATE
    updated = { id: eventId, featured: base.featured };
  } else {
    updated = await prisma.event.update({
      where: { id: eventId },
      data: { featured: nextFeatured },
      select: { id: true, featured: true },
    });
  }

  return {
    updatedEvent: {
      ...updated,
      attendeesConfirmedCount: confirmedCount, // “extra” field for the UI
    },
  };
}

export async function requestRefund(
  paymentId: string,
  reason?: string | null
): Promise<RefundActionResult> {
  const actor = await getAuthenticatedRefundActor()
  if (!actor) {
    return { success: false, message: 'Unauthorized. Please sign in to request a refund.', data: null }
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      userId: true,
      status: true,
      event: {
        select: {
          date: true,
        },
      },
      refundRequest: {
        select: {
          id: true,
          paymentId: true,
          status: true,
          stripeRefundId: true,
        },
      },
    },
  })

  if (!payment) {
    return { success: false, message: 'Payment not found.', data: null }
  }

  const isBuyer = payment.userId === actor.clerkId
  const isAdmin = actor.role === UserRole.admin
  if (!isBuyer && !isAdmin) {
    return { success: false, message: 'You can only request a refund for your own ticket.', data: null }
  }

  if (payment.status !== PaymentStatus.succeeded) {
    return { success: false, message: 'Only completed payments can be refunded.', data: null }
  }

  if (payment.refundRequest) {
    return { success: false, message: 'A refund request already exists for this payment.', data: null }
  }

  if (isBuyer) {
    const cutoffHours = getRefundRequestCutoffHours()
    const eligibility = computeRefundEligibility({
      hasPayment: true,
      eventStartsAt: payment.event.date,
      cutoffHours,
    })

    if (!eligibility.canRequest) {
      if (eligibility.blockedReason === 'EVENT_STARTED') {
        return {
          success: false,
          message: 'Refund requests are closed because this event has already started.',
          data: null,
        }
      }

      if (eligibility.blockedReason === 'CUTOFF') {
        return {
          success: false,
          message: getRefundRequestCutoffMessage(cutoffHours),
          data: null,
        }
      }

      return {
        success: false,
        message: 'Refund eligibility could not be determined right now.',
        data: null,
      }
    }
  }

  try {
    const created = await prisma.refundRequest.create({
      data: {
        paymentId: payment.id,
        requestedByUserId: payment.userId,
        source: RefundRequestSource.USER_REQUEST,
        reason: normalizeOptionalShortText(reason),
        status: RefundRequestStatus.requested,
      },
      select: {
        id: true,
        paymentId: true,
        status: true,
        stripeRefundId: true,
      },
    })

    await syncAttendanceEntitlementForRefundStatus({
      paymentId: payment.id,
      refundStatus: RefundRequestStatus.requested,
      context: `requestRefund(${payment.id})`,
    })

    return {
      success: true,
      message: 'Refund request submitted. An organizer or admin must approve it before it is processed.',
      data: toRefundActionData(created),
    }
  } catch (error) {
    console.error(`[refund] failed to create refund request for payment ${paymentId}`, error)

    const existing = await prisma.refundRequest.findUnique({
      where: { paymentId },
      select: {
        id: true,
        paymentId: true,
        status: true,
        stripeRefundId: true,
      },
    })

    if (existing) {
      return {
        success: false,
        message: 'A refund request already exists for this payment.',
        data: null,
      }
    }

    return { success: false, message: 'Failed to submit refund request. Please try again.', data: null }
  }
}

export async function approveRefund(refundRequestId: string): Promise<RefundActionResult> {
  const actor = await getAuthenticatedRefundActor()
  if (!actor) {
    return { success: false, message: 'Unauthorized. Please sign in to approve a refund.', data: null }
  }

  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: refundRequestId },
    select: {
      id: true,
      paymentId: true,
      status: true,
      stripeRefundId: true,
      payment: {
        select: {
          id: true,
          status: true,
          amountCents: true,
          stripeChargeId: true,
          stripePaymentIntentId: true,
          payoutTarget: true,
          event: {
            select: {
              id: true,
              createdBy: true,
            },
          },
        },
      },
    },
  })

  if (!refundRequest) {
    return { success: false, message: 'Refund request not found.', data: null }
  }

  const isAdmin = actor.role === UserRole.admin
  const isOrganizerOwner =
    actor.role === UserRole.organizer &&
    refundRequest.payment.event.createdBy === actor.clerkId

  if (!isAdmin && !isOrganizerOwner) {
    return { success: false, message: 'You do not have permission to approve this refund.', data: null }
  }

  if (refundRequest.payment.status !== PaymentStatus.succeeded) {
    return {
      success: false,
      message: 'This payment is no longer eligible for a refund.',
      data: null,
    }
  }

  if (refundRequest.status !== RefundRequestStatus.requested) {
    if (
      refundRequest.status === RefundRequestStatus.processing ||
      refundRequest.status === RefundRequestStatus.succeeded
    ) {
      return {
        success: true,
        message: getRefundRequestActionMessage(refundRequest.status),
        data: toRefundActionData(refundRequest),
      }
    }

    return {
      success: false,
      message: `This refund request cannot be approved from status "${refundRequest.status}".`,
      data: null,
    }
  }

  const claimSucceeded = await claimRefundRequestForProcessing({
    refundRequestId: refundRequest.id,
    paymentId: refundRequest.paymentId,
    actorClerkId: actor.clerkId,
    allowedStatuses: [RefundRequestStatus.requested],
  })

  if (!claimSucceeded) {
    const current = await getRefundActionSnapshot(refundRequest.id)

    if (
      current &&
      (current.status === RefundRequestStatus.processing ||
        current.status === RefundRequestStatus.succeeded)
    ) {
      return {
        success: true,
        message: getRefundRequestActionMessage(current.status),
        data: toRefundActionData(current),
      }
    }

    return {
      success: false,
      message: 'Unable to claim this refund request for processing.',
      data: null,
    }
  }

  return executeRefundForPayment({
    refundRequestId: refundRequest.id,
    payment: {
      id: refundRequest.payment.id,
      amountCents: refundRequest.payment.amountCents,
      stripeChargeId: refundRequest.payment.stripeChargeId,
      stripePaymentIntentId: refundRequest.payment.stripePaymentIntentId,
      payoutTarget: refundRequest.payment.payoutTarget,
    },
    idempotencyKey: `refund:${refundRequest.id}`,
    stripeReason: 'requested_by_customer',
    logContext: `failed to approve refund request ${refundRequest.id}`,
  })
}

async function executeRefundForPayment(input: {
  refundRequestId: string
  payment: {
    id: string
    amountCents: number
    stripeChargeId: string | null
    stripePaymentIntentId: string
    payoutTarget: PaymentPayoutTarget
  }
  idempotencyKey: string
  stripeReason?: 'requested_by_customer'
  logContext: string
}): Promise<RefundActionResult> {
  const chargeId = await resolveRefundChargeId(input.payment)

  if (!chargeId) {
    await markRefundRequestFailed(
      input.refundRequestId,
      input.payment.id,
      'Unable to resolve the Stripe charge for this payment.'
    )
    return {
      success: false,
      message: 'Unable to resolve the Stripe charge for this payment. The refund request was marked as failed.',
      data: null,
    }
  }

  try {
    const refundParams: Stripe.RefundCreateParams = {
      charge: chargeId,
      ...(input.stripeReason ? { reason: input.stripeReason } : {}),
    }

    if (input.payment.payoutTarget === PaymentPayoutTarget.organizer) {
      refundParams.reverse_transfer = true
      refundParams.refund_application_fee = true
    }

    const stripeRefund = await stripe.refunds.create(
      refundParams,
      {
        idempotencyKey: input.idempotencyKey,
      }
    )

    const mappedStatus = mapStripeRefundStatusToRefundRequestStatus(stripeRefund.status)
    const isFailureStatus =
      mappedStatus === RefundRequestStatus.failed || mappedStatus === RefundRequestStatus.canceled
    const resolvedStatus = isFailureStatus ? RefundRequestStatus.failed : mappedStatus
    const isFullRefund = evaluateIsFullRefund({
      refundAmountCents: stripeRefund.amount,
      paymentAmountCents: input.payment.amountCents,
    })

    const updated = await prisma.refundRequest.update({
      where: { id: input.refundRequestId },
      data: {
        stripeRefundId: stripeRefund.id,
        status: resolvedStatus,
        lastError: isFailureStatus
          ? `Stripe returned refund status "${stripeRefund.status ?? 'unknown'}".`
          : null,
      },
      select: {
        id: true,
        paymentId: true,
        status: true,
        stripeRefundId: true,
      },
    })

    await syncAttendanceEntitlementForRefundStatus({
      paymentId: updated.paymentId,
      refundStatus: updated.status,
      isFullRefund,
      context: `executeRefundForPayment(${input.refundRequestId})`,
    })

    if (updated.status === RefundRequestStatus.failed) {
      return {
        success: false,
        message: 'Stripe did not complete the refund. The refund request was marked as failed.',
        data: null,
      }
    }

    if (updated.status === RefundRequestStatus.succeeded) {
      try {
        await syncRefundRequestFromStripeRefund(stripeRefund)
      } catch (error) {
        console.error(
          `[refund] fallback refund finalization failed for refund request ${input.refundRequestId}`,
          error
        )
      }
    }

    return {
      success: true,
      message:
        updated.status === RefundRequestStatus.succeeded
          ? 'Refund completed successfully.'
          : 'Refund submitted to Stripe and is processing.',
      data: toRefundActionData(updated),
    }
  } catch (error) {
    console.error(`[refund] ${input.logContext}`, error)
    await markRefundRequestFailed(input.refundRequestId, input.payment.id, error)

    return {
      success: false,
      message: 'Refund processing failed. The refund request was marked as failed.',
      data: null,
    }
  }
}

export async function forceRefundByPayment(
  paymentId: string,
  note?: string | null
): Promise<RefundActionResult> {
  const actor = await getAuthenticatedRefundActor()
  if (!actor) {
    return { success: false, message: 'Unauthorized. Please sign in to issue a refund.', data: null }
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      userId: true,
      status: true,
      amountCents: true,
      stripeChargeId: true,
      stripePaymentIntentId: true,
      payoutTarget: true,
      event: {
        select: {
          createdBy: true,
        },
      },
      refundRequest: {
        select: {
          id: true,
          paymentId: true,
          status: true,
          stripeRefundId: true,
        },
      },
    },
  })

  if (!payment) {
    return { success: false, message: 'Payment not found.', data: null }
  }

  const isAdmin = actor.role === UserRole.admin
  const isOrganizerOwner =
    actor.role === UserRole.organizer && payment.event.createdBy === actor.clerkId

  if (!isAdmin && !isOrganizerOwner) {
    return { success: false, message: 'You do not have permission to issue this refund.', data: null }
  }

  if (payment.status !== PaymentStatus.succeeded) {
    return {
      success: false,
      message: 'This payment is no longer eligible for a refund.',
      data: null,
    }
  }

  let refundRequest = payment.refundRequest
  const claimableStatuses = getManualRefundClaimableStatuses(isAdmin)

  if (refundRequest) {
    if (
      refundRequest.stripeRefundId ||
      refundRequest.status === RefundRequestStatus.processing ||
      refundRequest.status === RefundRequestStatus.succeeded
    ) {
      return {
        success: true,
        message: getRefundRequestActionMessage(refundRequest.status),
        data: toRefundActionData(refundRequest),
      }
    }

    if (
      (refundRequest.status === RefundRequestStatus.rejected ||
        refundRequest.status === RefundRequestStatus.canceled) &&
      !isAdmin
    ) {
      return {
        success: false,
        message: 'Only admins can override rejected or canceled refund requests.',
        data: null,
      }
    }

    if (
      !claimableStatuses.includes(refundRequest.status)
    ) {
      return {
        success: false,
        message: `This payment cannot be manually refunded from status "${refundRequest.status}".`,
        data: null,
      }
    }

    const claimed = await claimRefundRequestForProcessing({
      refundRequestId: refundRequest.id,
      paymentId: payment.id,
      actorClerkId: actor.clerkId,
      note,
      allowedStatuses: claimableStatuses,
    })

    if (!claimed) {
      const current = await prisma.refundRequest.findUnique({
        where: { paymentId: payment.id },
        select: {
          id: true,
          paymentId: true,
          status: true,
          stripeRefundId: true,
        },
      })

      if (
        current &&
        (current.stripeRefundId ||
          current.status === RefundRequestStatus.processing ||
          current.status === RefundRequestStatus.succeeded)
      ) {
        return {
          success: true,
          message: getRefundRequestActionMessage(current.status),
          data: toRefundActionData(current),
        }
      }

      return {
        success: false,
        message: 'Unable to claim this refund request for processing.',
        data: null,
      }
    }
  } else {
    const attemptedAt = new Date()

    try {
      refundRequest = await prisma.refundRequest.create({
        data: {
          paymentId: payment.id,
          requestedByUserId: payment.userId,
          source: RefundRequestSource.MANUAL_OVERRIDE,
          status: RefundRequestStatus.processing,
          decidedByUserId: actor.clerkId,
          decidedAt: attemptedAt,
          decisionNote: normalizeOptionalShortText(note),
          attemptCount: 1,
          lastAttemptAt: attemptedAt,
          lastError: null,
        },
        select: {
          id: true,
          paymentId: true,
          status: true,
          stripeRefundId: true,
        },
      })
      await syncAttendanceEntitlementForRefundStatus({
        paymentId: payment.id,
        refundStatus: RefundRequestStatus.processing,
        context: `forceRefundByPayment.create(${payment.id})`,
      })
    } catch (error) {
      console.error(
        `[refund] failed to create manual refund request for payment ${payment.id}; retrying against the existing row if it was created concurrently`,
        error
      )

      const current = await prisma.refundRequest.findUnique({
        where: { paymentId: payment.id },
        select: {
          id: true,
          paymentId: true,
          status: true,
          stripeRefundId: true,
        },
      })

      if (
        current &&
        (current.stripeRefundId ||
          current.status === RefundRequestStatus.processing ||
          current.status === RefundRequestStatus.succeeded)
      ) {
        return {
          success: true,
          message: getRefundRequestActionMessage(current.status),
          data: toRefundActionData(current),
        }
      }

      if (
        current &&
        (current.status === RefundRequestStatus.rejected ||
          current.status === RefundRequestStatus.canceled) &&
        !isAdmin
      ) {
        return {
          success: false,
          message: 'Only admins can override rejected or canceled refund requests.',
          data: null,
        }
      }

      if (
        current &&
        claimableStatuses.includes(current.status)
      ) {
        const claimed = await claimRefundRequestForProcessing({
          refundRequestId: current.id,
          paymentId: payment.id,
          actorClerkId: actor.clerkId,
          note,
          allowedStatuses: claimableStatuses,
        })

        if (!claimed) {
          return {
            success: false,
            message: 'Unable to claim this refund request for processing.',
            data: null,
          }
        }

        refundRequest = current
      } else {
        return {
          success: false,
          message: 'Failed to create a manual refund request. Please try again.',
          data: null,
        }
      }
    }
  }

  if (!refundRequest) {
    return {
      success: false,
      message: 'Failed to prepare this refund for processing.',
      data: null,
    }
  }

  return executeRefundForPayment({
    refundRequestId: refundRequest.id,
    payment: {
      id: payment.id,
      amountCents: payment.amountCents,
      stripeChargeId: payment.stripeChargeId,
      stripePaymentIntentId: payment.stripePaymentIntentId,
      payoutTarget: payment.payoutTarget,
    },
    idempotencyKey: `force-refund:${payment.id}`,
    logContext: `failed to force refund for payment ${payment.id}`,
  })
}

export async function rejectRefund(
  refundRequestId: string,
  note?: string | null
): Promise<RefundActionResult> {
  const actor = await getAuthenticatedRefundActor()
  if (!actor) {
    return { success: false, message: 'Unauthorized. Please sign in to reject a refund.', data: null }
  }

  const refundRequest = await prisma.refundRequest.findUnique({
    where: { id: refundRequestId },
    select: {
      id: true,
      paymentId: true,
      status: true,
      stripeRefundId: true,
      payment: {
        select: {
          event: {
            select: {
              createdBy: true,
            },
          },
        },
      },
    },
  })

  if (!refundRequest) {
    return { success: false, message: 'Refund request not found.', data: null }
  }

  const isAdmin = actor.role === UserRole.admin
  const isOrganizerOwner =
    actor.role === UserRole.organizer &&
    refundRequest.payment.event.createdBy === actor.clerkId

  if (!isAdmin && !isOrganizerOwner) {
    return { success: false, message: 'You do not have permission to reject this refund.', data: null }
  }

  if (refundRequest.status === RefundRequestStatus.rejected) {
    return {
      success: true,
      message: 'This refund request has already been rejected.',
      data: toRefundActionData(refundRequest),
    }
  }

  if (refundRequest.status !== RefundRequestStatus.requested) {
    return {
      success: false,
      message: `This refund request cannot be rejected from status "${refundRequest.status}".`,
      data: null,
    }
  }

  const result = await prisma.refundRequest.updateMany({
    where: {
      id: refundRequest.id,
      status: RefundRequestStatus.requested,
    },
    data: {
      status: RefundRequestStatus.rejected,
      decidedByUserId: actor.clerkId,
      decidedAt: new Date(),
      decisionNote: normalizeOptionalShortText(note),
    },
  })

  if (result.count === 0) {
    const current = await prisma.refundRequest.findUnique({
      where: { id: refundRequest.id },
      select: {
        id: true,
        paymentId: true,
        status: true,
        stripeRefundId: true,
      },
    })

    if (current?.status === RefundRequestStatus.rejected) {
      return {
        success: true,
        message: 'This refund request has already been rejected.',
        data: toRefundActionData(current),
      }
    }

    return {
      success: false,
      message: 'Unable to reject this refund request.',
      data: null,
    }
  }

  await syncAttendanceEntitlementForRefundStatus({
    paymentId: refundRequest.paymentId,
    refundStatus: RefundRequestStatus.rejected,
    context: `rejectRefund(${refundRequest.id})`,
  })

  const updated = await prisma.refundRequest.findUnique({
    where: { id: refundRequest.id },
    select: {
      id: true,
      paymentId: true,
      status: true,
      stripeRefundId: true,
    },
  })

  if (!updated) {
    return {
      success: false,
      message: 'Refund request was updated but could not be reloaded.',
      data: null,
    }
  }

  return {
    success: true,
    message: 'Refund request rejected.',
    data: toRefundActionData(updated),
  }
}



/**
 * Toggles the RSVP status for a user on a specific event.
 * If the user is currently attending (confirmed + active entitlement), it is canceled.
 * If not:
 *   - For FREE events: a new 'confirmed' RSVP is created immediately.
 *   - For PAID events: returns action 'payment_required' (webhook will create RSVP after payment succeeds).
 * @param eventId The ID of the event to RSVP to.
 * @returns An object with the operation's result.
 */
export async function toggleRSVP(eventId: string): Promise<ToggleRsvpResult> {
    const { userId } = await auth();
    if (!userId) throw new Error('Unauthorized');

    // Look for an existing RSVP for this user and event.
    const existingRSVP = await prisma.rSVP.findUnique({
        where: {
            userId_eventId: {
                userId,
                eventId,
            },
        },
    });

    let result: ToggleRsvpResult;

    const isExistingCurrentlyAttending =
      existingRSVP?.status === RSVPStatus.confirmed &&
      hasActiveAttendanceEntitlement(existingRSVP.attendanceEntitlementStatus);

    if (isExistingCurrentlyAttending) {
      await prisma.rSVP.update({
        where: {
          userId_eventId: {
            userId,
            eventId,
          },
        },
        data: {
          status: RSVPStatus.canceled,
        },
      });

      console.log(`User ${userId} cancelled RSVP status for event ${eventId}`);
      const { updatedEvent } = await updateEventFeaturedAndCount(eventId);

      result = {
        success: true,
        action: "cancelled",
        message: "Attendance successfully cancelled.",
        rsvpCancelled: true,
        userId,
        updatedEvent,
      };
    } else {
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { isPaid: true, date: true, archivedAt: true, createdBy: true },
      });

      if (!event) {
        return { success: false, message: "Event not found" };
      }

      const joinability = getEventJoinability({
        date: event.date,
        archivedAt: event.archivedAt,
      });
      if (!joinability.isJoinable) {
        return { success: false, message: joinability.message };
      }

      const isCreatorViewingOwnEvent = event.createdBy === userId;

      if (existingRSVP) {
        if (
          !isCreatorViewingOwnEvent &&
          !hasActiveAttendanceEntitlement(existingRSVP.attendanceEntitlementStatus)
        ) {
          if (
            existingRSVP.attendanceEntitlementStatus ===
            RSVPAttendanceEntitlementStatus.refund_pending_hold
          ) {
            return {
              success: false,
              message:
                'Your refund is still processing. You can rejoin after the refund finishes.',
            };
          }

          if (
            existingRSVP.attendanceEntitlementStatus ===
            RSVPAttendanceEntitlementStatus.revoked_refunded
          ) {
            return {
              success: false,
              message:
                'This ticket was refunded. Please purchase again to attend this event.',
            };
          }
        }

        const shouldRestoreCreatorEntitlement =
          isCreatorViewingOwnEvent &&
          !hasActiveAttendanceEntitlement(existingRSVP.attendanceEntitlementStatus);

        const restoreData: {
          status: RSVPStatus;
          attendanceEntitlementStatus?: RSVPAttendanceEntitlementStatus;
        } = {
          status: RSVPStatus.confirmed,
        };

        if (shouldRestoreCreatorEntitlement) {
          // Creator-bypass restore must be visible to attendance-aware read paths.
          restoreData.attendanceEntitlementStatus = RSVPAttendanceEntitlementStatus.active;
        }

        const restoredRsvp = await prisma.rSVP.update({
          where: { id: existingRSVP.id },
          data: restoreData,
          include: {
            user: {
              select: {
                clerkId: true,
                username: true,
                firstName: true,
                lastName: true,
                imageUrl: true,
                hasImage: true,
                role: true,
              },
            },
          },
        });

        console.log(`User ${userId} restored RSVP for event ${eventId}`);
        const { updatedEvent } = await updateEventFeaturedAndCount(eventId);

        result = {
          success: true,
          action: "created",
          message: "Successfully confirmed attendance!",
          newRsvp: restoredRsvp,
          updatedEvent,
        };
      } else if (event.isPaid && !isCreatorViewingOwnEvent) {
        console.log(`User ${userId} initiated checkout for paid event ${eventId}`);
        result = {
          success: true,
          action: "payment_required",
          message: "Payment required to complete your RSVP.",
          eventId,
          isPaid: true,
        };
      } else {
        const newRsvp = await prisma.rSVP.create({
          data: {
            userId,
            eventId,
            status: RSVPStatus.confirmed,
          },
          include: {
            user: {
              select: {
                clerkId: true,
                username: true,
                firstName: true,
                lastName: true,
                imageUrl: true,
                hasImage: true,
                role: true,
              }
            }
          }
        });

        console.log(`User ${userId} RSVP'd to free event ${eventId}`);
        const { updatedEvent } = await updateEventFeaturedAndCount(eventId);

        result = {
          success: true,
          action: "created",
          message: "Successfully confirmed attendance!",
          newRsvp: newRsvp,
          updatedEvent
        };
      }
    }

    return result;
}

/**
 * Reactivates RSVP for a user who has already paid but canceled their attendance.
 * Called when user clicks "Attend" again on a paid event after canceling.
 * 
 * Flow:
 * 1. Find existing succeeded Payment for (userId, eventId)
 * 2. If found, upsert RSVP to confirmed (via linkRsvpToSucceededPayment)
 * 3. Link Payment.rsvpId to the RSVP
 * 4. Recalculate event featured
 * 5. Return updated event info
 * 
 * This does NOT create a new PaymentIntent or charge the user again.
 */
export async function reactivateAlreadyPaidRsvp(eventId: string): Promise<ToggleRsvpResult> {
  const { userId } = await auth();
  if (!userId) throw new Error('Unauthorized');

  // Verify event exists and is paid
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { isPaid: true, date: true, archivedAt: true },
  });

  if (!event) {
    return { success: false, message: 'Event not found' };
  }

  if (!event.isPaid) {
    return { success: false, message: 'Event is not a paid event' };
  }

  const joinability = getEventJoinability({
    date: event.date,
    archivedAt: event.archivedAt,
  });
  if (!joinability.isJoinable) {
    return { success: false, message: joinability.message };
  }

  // Find existing succeeded payment (should exist if called from ALREADY_PAID_NOT_ATTENDING flow)
  const payment = await prisma.payment.findFirst({
    where: {
      eventId,
      userId,
      status: PaymentStatus.succeeded,
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      amountCents: true,
      stripePaymentIntentId: true,
      payoutTarget: true,
      refundRequest: {
        select: {
          status: true,
          stripeRefundId: true,
        },
      },
    },
  });

  if (!payment) {
    return {
      success: false,
      message: 'No payment found for this event. Please complete payment first.',
    };
  }

  const ticketState = await resolveTicketStateForSucceededPayment({
    paymentId: payment.id,
    amountCents: payment.amountCents,
    refundRequest: payment.refundRequest,
  });

  if (ticketState === 'refund_pending') {
    return {
      success: false,
      message:
        'Your previous ticket refund is still processing. You can rejoin once it is completed.',
    };
  }

  if (ticketState === 'refunded') {
    return {
      success: false,
      message: 'This ticket was refunded. Please purchase again to attend this event.',
    };
  }

  // Reactivate RSVP via shared linking helper
  try {
    const linkResult = await linkRsvpToSucceededPayment(payment.id, userId, eventId);
    if (!linkResult.linked) {
      return {
        success: false,
        message: getEventJoinabilityBlockedMessage(linkResult.blockedReason),
      };
    }

    // Fetch updated event for response
    const { updatedEvent } = await updateEventFeaturedAndCount(eventId);

    return {
      success: true,
      action: 'reactivated',
      message: 'Successfully restored your attendance. You are now registered for this event.',
      userId,
      updatedEvent,
    };
  } catch (err) {
    console.error(`[reactivateAlreadyPaidRsvp] error for event ${eventId}, user ${userId}:`, err);
    return {
      success: false,
      message: 'Failed to restore attendance. Please try again.',
    };
  }
}

// Interface for the reminder input data.
interface ReminderInput {
    preferenceType: ReminderType; // e.g., FORTY_EIGHT_HOURS, SAME_DAY, MINUTES_BEFORE
    offsetMinutes: number;        // The exact offset in minutes before the event.
                                  // e.g., 48h = 2880, 4h = 240, 45m = 45
}

/**
 * Successful responses **must** include `updatedRsvp`.
 * Failure responses carry only a message.
 */
export type ReminderResult =
  | { success: true;  message: string; updatedRsvp: ReminderPatch }
  | { success: false; message: string };

/**
 * --- NEW SERVER ACTION ---
 * Updates or clears the reminder preference for a user's RSVP.
 * @param eventId The ID of the event.
 * @param reminderDetails An object with reminder preferences, or null to clear them.
 * @returns An object with the operation's result.
 */
export async function updateReminderPreference(
        eventId: string,
         reminderDetails: ReminderInput | null
        ): Promise<ReminderResult> {
    const { userId } = await auth();
    if (!userId) {
        console.error("Error: Unauthenticated user trying to update reminder preferences.");
        return { success: false, message: 'Unauthorized. Please sign in to update preferences.' };
    }

    try {
       /* ------------------------------------------------------------------
        * 1) Find RSVP with only the necessary fields
        * ------------------------------------------------------------------ */
        const rsvp = await prisma.rSVP.findUnique({
            where: { userId_eventId: { userId, eventId } },
            select: {
                id: true,
                status: true,
                reminderPreferenceType: true,
                reminderOffsetMinutes:  true,
                reminderScheduledAt:    true,
                reminderSentAt:         true,
                event: { select: { date: true, eventTimeZone: true } }, // only to calculate scheduledAt
            },
        });

        if (!rsvp) {
            console.warn(`RSVP not found for user ${userId}, event ${eventId} when setting reminder preference.`);
            return { success: false, message: "RSVP not found. Please RSVP to the event first." };
        }

        if (rsvp.status !== RSVPStatus.confirmed) {
            console.warn(`User ${userId} tried to set reminder for non-confirmed RSVP. Event: ${eventId}, Status: ${rsvp.status}`);
            return { success: false, message: "Reminders can only be set for confirmed RSVPs." };
        }

        const eventDate = new Date(rsvp.event.date); // Event date (assuming it's stored in UTC).
        const now = new Date();

        // If the user chooses "No reminders" (reminderDetails is null).
        if (reminderDetails === null) {
            const cleared = await prisma.rSVP.update({
                where: { id: rsvp.id },
                data: {
                    reminderPreferenceType: null,
                    reminderOffsetMinutes:  null,
                    reminderScheduledAt:    null,
                    reminderSentAt:         null,
                },
                select: { // same as above
                    status: true,
                    reminderPreferenceType: true,
                    reminderOffsetMinutes:  true,
                    reminderScheduledAt:    true,
                    reminderSentAt:         true,
                },
            });

            const patch: ReminderPatch = {
                userClerkId: userId,
                status: cleared.status,
                reminderPreferenceType: null,
                reminderOffsetMinutes:  null,
                reminderScheduledAt:    null,
                reminderSentAt:         null,
            };
            console.log(`User ${userId} opted out of reminders for event ${eventId}.`);
            return {
                success: true,
                message: "Reminder preference cleared successfully.",
                updatedRsvp: patch,
            };
        }

        // If the user chooses a specific reminder preference.
        const { preferenceType, offsetMinutes } = reminderDetails;
        
        // Ensure the offset is a positive number.
        if (offsetMinutes <= 0) {
            console.warn(`Invalid offsetMinutes: ${offsetMinutes} for event ${eventId}, user ${userId}.`);
            return { success: false, message: "Reminder time must be before the event."}
        }

        // Calculate the exact time the reminder should be sent.
        const calculatedScheduledAt = calcReminderUTC(
            eventDate,                         // UTC
            rsvp.event.eventTimeZone,          // event's own timezone
            preferenceType as ReminderType,
            offsetMinutes
        );

        // Validation: The calculated reminder time must not be in the past.
        // We give a small margin (e.g., 1 minute) for potential small delays.
        if (calculatedScheduledAt.getTime() < now.getTime() - 60 * 1000) {
            console.warn(`Calculated reminder time is in the past. Event: ${eventId}, User: ${userId}, Scheduled: ${calculatedScheduledAt.toISOString()}, Now: ${now.toISOString()}`);
            return { success: false, message: "Cannot schedule a reminder for a time that has already passed. Please choose a valid option." };
        }

        // Update the RSVP record with the new reminder details.
        const updated = await prisma.rSVP.update({
            where: { id: rsvp.id },
            data: {
                reminderPreferenceType: preferenceType,
                reminderOffsetMinutes:  offsetMinutes,
                reminderScheduledAt:    calculatedScheduledAt,
                reminderSentAt:         null,
            },
            select: { // only reminder and status fields
                status: true,
                reminderPreferenceType: true,
                reminderOffsetMinutes:  true,
                reminderScheduledAt:    true,
                reminderSentAt:         true,
            },
        });

        const patch: ReminderPatch = {
            userClerkId: userId,
            status: updated.status,
            reminderPreferenceType: updated.reminderPreferenceType,
            reminderOffsetMinutes:  updated.reminderOffsetMinutes,
            reminderScheduledAt:    updated.reminderScheduledAt,
            reminderSentAt:         updated.reminderSentAt,
        };

        console.log(`User ${userId} set reminder for event ${eventId}: Type: ${preferenceType}, Offset: ${offsetMinutes}m, Scheduled: ${calculatedScheduledAt.toISOString()}`);

        return {
            success: true,
            message: `Reminder scheduled! We'll notify you approx. ${formatOffset(offsetMinutes)} before the event.`,
            updatedRsvp: patch, // Return the updated RSVP patch
        };

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Failed to update reminder preference.";
        console.error(`Error updating reminder preference for user ${userId}, event ${eventId}:`, errorMessage, error);
        return { success: false, message: "Failed to update reminder preference." };
    }
}

/**
 * Helper function to format the offset in minutes into a user-friendly string.
 * @param offsetMinutes The offset in minutes.
 * @returns A formatted string (e.g., "2 days", "4 hours", "30 minutes").
 */
function formatOffset(offsetMinutes: number): string {
    if (offsetMinutes >= 60 * 24 * 2) { // 2 days or more
        return `${Math.round(offsetMinutes / (60 * 24))} days`;
    } else if (offsetMinutes >= 60 * 24) { // 1 day
        return `1 day`;
    } else if (offsetMinutes >= 60) { // Hours
        const hours = Math.floor(offsetMinutes / 60);
        const minutes = offsetMinutes % 60;
        if (minutes === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
        return `${hours}h ${minutes}min`;
    } else { // Minutes
        return `${offsetMinutes} minutes`;
    }
}
