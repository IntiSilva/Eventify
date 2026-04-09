"use client"

import { PaymentPayoutTarget } from "@/generated/prisma"
import { cn, formatPrice } from "@/lib/utils"
import type { AdminPaymentListItem } from "../types/payments"

interface PaymentRowProps {
  payment: AdminPaymentListItem
  isSelected: boolean
  scope?: "admin" | "organizer"
  onSelect: (paymentId: string) => void
}

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return "Unknown"
  return parsed.toLocaleString()
}

function getPersonLabel(input: {
  username?: string | null
  firstName?: string | null
  lastName?: string | null
  fallback: string
}): string {
  const fullName = [normalizeOptional(input.firstName), normalizeOptional(input.lastName)]
    .filter((part): part is string => Boolean(part))
    .join(" ")

  if (fullName.length > 0) return fullName

  const username = normalizeOptional(input.username)
  if (username) return `@${username}`

  return input.fallback
}

function getRefundStateMeta(refundState: AdminPaymentListItem["refundState"]): {
  label: string
  className: string
} {
  switch (refundState) {
    case "requested":
      return {
        label: "Refund requested",
        className: "border-amber-700/60 bg-amber-950/35 text-amber-200",
      }
    case "processing":
      return {
        label: "Refund processing",
        className: "border-sky-700/60 bg-sky-950/35 text-sky-200",
      }
    case "failed":
      return {
        label: "Refund failed",
        className: "border-rose-700/60 bg-rose-950/35 text-rose-200",
      }
    case "rejected":
      return {
        label: "Refund rejected",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-200",
      }
    case "succeeded":
      return {
        label: "Refund succeeded",
        className: "border-emerald-700/60 bg-emerald-950/35 text-emerald-200",
      }
    case "canceled":
      return {
        label: "Refund canceled",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-200",
      }
    case "no_refund":
    default:
      return {
        label: "No refund",
        className: "border-zinc-700/80 bg-zinc-900 text-zinc-300",
      }
  }
}

function getOwnerLabel(ownerRole: AdminPaymentListItem["ownerRole"]): string {
  if (ownerRole === "admin") return "Admin owner"
  if (ownerRole === "organizer") return "Organizer owner"
  if (ownerRole === "user") return "User owner"
  return "Owner"
}

function getPaymentStatusLabel(status: AdminPaymentListItem["paymentStatus"]): string {
  switch (status) {
    case "pending":
      return "Pending"
    case "failed":
      return "Failed"
    case "canceled":
      return "Canceled"
    case "succeeded":
    default:
      return "Succeeded"
  }
}

export function PaymentRow({ payment, isSelected, scope = "admin", onSelect }: PaymentRowProps) {
  const isOrganizerScope = scope === "organizer"
  const buyerLabel = getPersonLabel({
    username: payment.buyerUsername,
    firstName: payment.buyerFirstName,
    lastName: payment.buyerLastName,
    fallback: payment.buyerUserId,
  })
  const ownerLabel = getPersonLabel({
    username: payment.ownerUsername,
    firstName: payment.ownerFirstName,
    lastName: payment.ownerLastName,
    fallback: payment.ownerClerkId,
  })
  const payoutLabel =
    payment.payoutTarget === PaymentPayoutTarget.organizer
      ? "Organizer payout"
      : "Platform payout"
  const refundMeta = getRefundStateMeta(payment.refundState)
  const ownerLabelPrefix = getOwnerLabel(payment.ownerRole)
  const paymentStatusLabel = getPaymentStatusLabel(payment.paymentStatus)

  return (
    <button
      type="button"
      onClick={() => onSelect(payment.paymentId)}
      className={cn(
        "flex w-full items-center gap-3 border-b border-border/50 px-3 py-2.5 text-left transition-colors cursor-pointer",
        "hover:bg-emerald-800/10 focus-visible:bg-accent/50",
        "focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none",
        isSelected && "bg-emerald-800/25"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-white">{payment.eventTitle}</span>
          {!isOrganizerScope ? (
            <span
              className={cn(
                "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
                payment.payoutTarget === PaymentPayoutTarget.organizer
                  ? "border-emerald-700/50 bg-emerald-950/35 text-emerald-200"
                  : "border-violet-700/50 bg-violet-950/35 text-violet-200"
              )}
            >
              {payoutLabel}
            </span>
          ) : null}
          <span
            className={cn(
              "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
              refundMeta.className
            )}
          >
            {refundMeta.label}
          </span>
        </div>

        {isOrganizerScope ? (
          <p className="mt-1 truncate text-xs text-zinc-300">
            <span className="text-zinc-500">Buyer:</span>{" "}
            <span className="text-zinc-200">{buyerLabel}</span>
          </p>
        ) : (
          <p className="mt-1 truncate text-xs text-zinc-300">
            <span className="text-zinc-500">Buyer:</span> <span className="text-zinc-200">{buyerLabel}</span>
            <span className="mx-1 text-zinc-600">|</span>
            <span className="text-zinc-500">{ownerLabelPrefix}:</span>{" "}
            <span className="text-zinc-200">{ownerLabel}</span>
          </p>
        )}

        <p className="mt-1 text-[11px] text-zinc-500">{formatTimestamp(payment.createdAt)}</p>
      </div>

      <div className="shrink-0 text-right">
        <span className="text-sm font-semibold tabular-nums text-white leading-none">
          {formatPrice(payment.amountCents, payment.currency) || payment.currency}
        </span>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
          {paymentStatusLabel}
        </p>
      </div>
    </button>
  )
}

export function PaymentRowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-3 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="h-4 w-36 animate-pulse rounded bg-zinc-800" />
          <div className="h-4 w-20 animate-pulse rounded bg-zinc-800" />
        </div>
        <div className="mt-1 h-3 w-56 animate-pulse rounded bg-zinc-800" />
        <div className="mt-1 h-3 w-28 animate-pulse rounded bg-zinc-800" />
      </div>
      <div className="h-4 w-16 animate-pulse rounded bg-zinc-800" />
    </div>
  )
}
