import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { listAdminPayments } from "@/lib/admin/payments"
import type { ApiErrorResponse } from "@/types/api"
import type {
  AdminPaymentCurrencyFilter,
  AdminPaymentPayoutTargetFilter,
  AdminPaymentStatusFilter,
  AdminPaymentRefundStateFilter,
  AdminPaymentsListApiResponse,
} from "@/components/Payments/payments/types/payments"

function normalizePaymentStatus(value: string | null): AdminPaymentStatusFilter {
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

function normalizeCurrency(value: string | null): AdminPaymentCurrencyFilter | null {
  if (!value) return null
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.toLowerCase() === "all") return null
  if (!/^[a-z]{3}$/i.test(normalized)) return null
  return normalized
}

function normalizeRefundState(value: string | null): AdminPaymentRefundStateFilter {
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

function normalizePayoutTarget(value: string | null): AdminPaymentPayoutTargetFilter {
  switch (value) {
    case "organizer":
    case "platform":
      return value
    case "all":
    default:
      return "all"
  }
}

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export async function GET(request: Request) {
  try {
    const { userId: requesterId, sessionClaims } = await auth()

    if (!requesterId) {
      const payload: ApiErrorResponse = {
        success: false,
        error: "Unauthorized",
      }
      return NextResponse.json(payload, { status: 401 })
    }

    if (sessionClaims?.publicMetadata?.role !== "admin") {
      const payload: ApiErrorResponse = {
        success: false,
        error: "Forbidden",
      }
      return NextResponse.json(payload, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const result = await listAdminPayments({
      limit: parseLimit(searchParams.get("limit")),
      search: searchParams.get("search"),
      paymentStatus: normalizePaymentStatus(searchParams.get("paymentStatus")),
      currency: normalizeCurrency(searchParams.get("currency")),
      refundState: normalizeRefundState(searchParams.get("refundState")),
      payoutTarget: normalizePayoutTarget(searchParams.get("payoutTarget")),
    })

    const payload: AdminPaymentsListApiResponse = {
      success: true,
      data: result.data,
      hasMore: result.hasMore,
      availableCurrencies: result.availableCurrencies,
      filter: result.filter,
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error("[API /admin/payments] Error:", error)
    const message = error instanceof Error ? error.message : "Unknown error"

    const payload: ApiErrorResponse = {
      success: false,
      error: `Failed to fetch admin payments: ${message}`,
    }

    return NextResponse.json(payload, { status: 500 })
  }
}
